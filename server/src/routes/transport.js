import { Router } from 'express';
import { Driver, FuelRecord, Route, TransportAllocation, Vehicle, VehicleMaintenance } from '../db/mongo/models.js';
import { lift, plain, startsWith } from '../db/mongo/query.js';
import { asyncHandler, ok } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';
import { createResourceRouter } from '../lib/crud.js';
import { isAdmin, accessibleStudentIds } from '../lib/scope.js';
import { oid } from '../db/mongo/connection.js';

const router = Router();

router.use(
  '/vehicles',
  createResourceRouter({
    table: 'vehicles',
    module: 'transport',
    entityType: 'Vehicle',
    counts: {
      route_count: { from: 'routes', on: 'vehicle_id' },
      student_count: { from: 'transport_allocations', on: 'vehicle_id', where: { status: 'ACTIVE' } },
      fuel_cost: { from: 'fuel_records', on: 'vehicle_id', sum: 'total_cost' },
      maintenance_cost: { from: 'vehicle_maintenance', on: 'vehicle_id', sum: 'cost' },
    },
    searchable: ['vehicle_number', 'model'],
    filterable: ['vehicle_type', 'status'],
    sortable: ['id', 'vehicle_number', 'capacity'],
    required: ['vehicle_number'],
    defaultSort: 'vehicle_number',
  })
);

router.use(
  '/drivers',
  createResourceRouter({
    table: 'drivers',
    module: 'transport',
    entityType: 'Driver',
    populate: { vehicle_id: { vehicle_number: 'vehicle_number' } },
    searchable: ['name', 'phone', 'license_number'],
    filterable: ['status', 'vehicle_id'],
    sortable: ['id', 'name'],
    required: ['name', 'phone', 'license_number'],
    defaultSort: 'name',
  })
);

router.use(
  '/routes',
  createResourceRouter({
    table: 'routes',
    module: 'transport',
    entityType: 'Route',
    populate: {
      vehicle_id: { vehicle_number: 'vehicle_number', capacity: 'capacity' },
      driver_id: { name: 'driver_name', phone: 'driver_phone' },
    },
    counts: {
      student_count: { from: 'transport_allocations', on: 'route_id', where: { status: 'ACTIVE' } },
    },
    searchable: ['name', 'route_code', 'start_point', 'end_point'],
    filterable: ['status', 'vehicle_id', 'driver_id'],
    sortable: ['id', 'name', 'fare'],
    required: ['route_code', 'name'],
    defaultSort: 'name',
  })
);

router.use(
  '/allocations',
  createResourceRouter({
    table: 'transport_allocations',
    module: 'transport',
    entityType: 'Transport Allocation',
    populate: {
      student_id: { first_name: 'first_name', last_name: 'last_name', admission_number: 'admission_number' },
      'student_id.class_id': { name: 'class_name' },
      'student_id.section_id': { name: 'section_name' },
      route_id: { name: 'route_name', route_code: 'route_code' },
      'route_id.driver_id': { name: 'driver_name', phone: 'driver_phone' },
      /*
       * The vehicle was joined on COALESCE(ta.vehicle_id, r.vehicle_id): an
       * allocation may name its own vehicle, and otherwise takes the route's.
       * Both are fetched and the fallback applied below, because a populate
       * cannot express "this one, or that one".
       */
      vehicle_id: { vehicle_number: 'own_vehicle_number' },
      'route_id.vehicle_id': { vehicle_number: 'route_vehicle_number' },
    },
    derive: (row) => ({
      vehicle_number: row.own_vehicle_number ?? row.route_vehicle_number ?? null,
    }),
    searchable: [],
    filterable: ['student_id', 'route_id', 'status', 'academic_year_id'],
    sortable: ['id'],
    required: ['student_id', 'route_id'],
    // Students and parents only see their own allocation.
    scopeFilter: async (req) => {
      const allowed = await accessibleStudentIds(req.user);
      if (allowed === null) return null;
      // Entitled to none must mean none: a filter on a field is dropped by
      // strictQuery, and a dropped filter shows everything.
      if (!allowed.length) return { $expr: { $eq: [1, 0] } };
      return { student_id: { $in: allowed.map(oid).filter(Boolean) } };
    },
  })
);

router.use(
  '/fuel',
  createResourceRouter({
    table: 'fuel_records',
    module: 'transport',
    entityType: 'Fuel Record',
    populate: {
      vehicle_id: { vehicle_number: 'vehicle_number' },
      recorded_by: { full_name: 'recorded_by_name' },
    },
    searchable: ['bill_number'],
    filterable: ['vehicle_id'],
    sortable: ['id', 'fuel_date', 'total_cost'],
    required: ['vehicle_id', 'litres', 'rate_per_litre', 'total_cost'],
    defaultSort: 'fuel_date',
    beforeCreate: (data, req) => ({ ...data, recorded_by: req.user.id }),
  })
);

router.use(
  '/maintenance',
  createResourceRouter({
    table: 'vehicle_maintenance',
    module: 'transport',
    entityType: 'Vehicle Maintenance',
    populate: {
      vehicle_id: { vehicle_number: 'vehicle_number' },
      recorded_by: { full_name: 'recorded_by_name' },
    },
    searchable: ['service_type', 'garage'],
    filterable: ['vehicle_id'],
    sortable: ['id', 'service_date', 'cost'],
    required: ['vehicle_id', 'service_type'],
    defaultSort: 'service_date',
    beforeCreate: (data, req) => ({ ...data, recorded_by: req.user.id }),
  })
);

router.use(
  '/driver-attendance',
  createResourceRouter({
    table: 'driver_attendance',
    module: 'transport',
    entityType: 'Driver Attendance',
    populate: { driver_id: { name: 'driver_name', phone: 'phone' } },
    searchable: [],
    filterable: ['driver_id', 'status', 'attendance_date'],
    sortable: ['id', 'attendance_date'],
    required: ['driver_id', 'attendance_date', 'status'],
    defaultSort: 'attendance_date',
  })
);

/** Transport overview: fleet, occupancy and running costs. */
router.get(
  '/summary',
  requirePermission('transport.view'),
  asyncHandler(async (req, res) => {
    const campusId = req.user.campus_id;
    const scope = isAdmin(req.user) && !campusId ? {} : { campus_id: oid(campusId) };

    /** A CASE-counted total, as the fleet summary asked for. */
    const [fleetRow] = await Vehicle.aggregate([
      { $match: scope },
      {
        $group: {
          _id: null,
          vehicles: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } },
          in_maintenance: { $sum: { $cond: [{ $eq: ['$status', 'MAINTENANCE'] }, 1, 0] } },
          total_capacity: { $sum: { $ifNull: ['$capacity', 0] } },
        },
      },
    ]);
    const fleet = fleetRow || { vehicles: 0, active: 0, in_maintenance: 0, total_capacity: 0 };

    const [routes, drivers, allocations] = await Promise.all([
      Route.countDocuments(scope),
      Driver.countDocuments(scope),
      TransportAllocation.countDocuments({ ...scope, status: 'ACTIVE' }),
    ]);

    // Costs for this calendar year. The dates are text, so the year is matched
    // on the first four characters exactly as the SQL did.
    const year = new Date().toISOString().slice(0, 4);
    const sumThisYear = async (Model, dateField, valueField) => {
      const [row] = await Model.aggregate([
        { $match: { ...scope, [dateField]: startsWith(year) } },
        { $group: { _id: null, n: { $sum: { $ifNull: [`$${valueField}`, 0] } } } },
      ]);
      return row?.n ?? 0;
    };
    const fuelYtd = await sumThisYear(FuelRecord, 'fuel_date', 'total_cost');
    const maintenanceYtd = await sumThisYear(VehicleMaintenance, 'service_date', 'cost');

    // How full each route is. The allocated count was a correlated subquery;
    // it is one grouped query here rather than one per route.
    const routeDocs = await Route.find(scope)
      .select('name route_code fare vehicle_id')
      .populate('vehicle_id', 'vehicle_number capacity')
      .sort({ name: 1 });
    const allocated = await TransportAllocation.aggregate([
      { $match: { ...scope, status: 'ACTIVE' } },
      { $group: { _id: '$route_id', n: { $sum: 1 } } },
    ]);
    const allocatedByRoute = new Map(allocated.map((a) => [String(a._id), a.n]));
    const routeOccupancy = lift(routeDocs, {
      vehicle_id: { vehicle_number: 'vehicle_number', capacity: 'capacity' },
    }).map((r) => ({ ...r, allocated: allocatedByRoute.get(r.id) ?? 0 }));

    /*
     * Papers falling due within sixty days.
     *
     * Compared as text, which works because the dates are stored as ISO days
     * and sort the same way — the comparison the SQL made with substr(). A
     * vehicle with neither date recorded is not due for anything, so a null
     * must not match, which `$lte` on a missing field would otherwise do.
     */
    const horizon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const dueBy = (field) => ({ [field]: { $ne: null, $lte: `${horizon}\uffff` } });
    const expiring = plain(
      await Vehicle.find({ ...scope, $or: [dueBy('insurance_expiry'), dueBy('fitness_expiry')] })
        .select('vehicle_number insurance_expiry fitness_expiry')
    );

    return ok(res, {
      fleet,
      routes,
      drivers,
      allocations,
      costs: { fuelYtd, maintenanceYtd, total: fuelYtd + maintenanceYtd },
      routeOccupancy,
      expiring,
    });
  })
);

export default router;
