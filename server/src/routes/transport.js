import { Router } from 'express';
import { all, get, scalar } from '../db/connection.js';
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
    const scope = isAdmin(req.user) && !campusId ? '' : ' WHERE campus_id = ?';
    const p = scope ? [campusId] : [];

    const fleet = await get(
      `SELECT COUNT(*) AS vehicles,
              SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN status = 'MAINTENANCE' THEN 1 ELSE 0 END) AS in_maintenance,
              COALESCE(SUM(capacity), 0) AS total_capacity
         FROM vehicles${scope}`,
      p
    );
    const routes = Number(await scalar(`SELECT COUNT(*) AS n FROM routes${scope}`, p));
    const drivers = Number(await scalar(`SELECT COUNT(*) AS n FROM drivers${scope}`, p));
    const allocations = Number(
      await scalar(`SELECT COUNT(*) AS n FROM transport_allocations${scope}${scope ? ' AND' : ' WHERE'} status = 'ACTIVE'`, p)
    );

    const fuelYtd = Number(
      await scalar(
        `SELECT COALESCE(SUM(total_cost), 0) AS n FROM fuel_records
          WHERE substr(fuel_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY')${scope ? ' AND campus_id = ?' : ''}`,
        p
      )
    );
    const maintenanceYtd = Number(
      await scalar(
        `SELECT COALESCE(SUM(cost), 0) AS n FROM vehicle_maintenance
          WHERE substr(service_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY')${scope ? ' AND campus_id = ?' : ''}`,
        p
      )
    );

    const routeOccupancy = await all(
      `SELECT r.id, r.name, r.route_code, r.fare, v.vehicle_number, v.capacity,
              (SELECT COUNT(*) FROM transport_allocations ta WHERE ta.route_id = r.id AND ta.status = 'ACTIVE') AS allocated
         FROM routes r LEFT JOIN vehicles v ON v.id = r.vehicle_id${scope ? ' WHERE r.campus_id = ?' : ''}
        ORDER BY r.name`,
      p
    );

    const expiring = await all(
      `SELECT vehicle_number, insurance_expiry, fitness_expiry FROM vehicles
        WHERE (substr(insurance_expiry, 1, 10) <= to_char((now() AT TIME ZONE 'UTC') + interval '+60 days', 'YYYY-MM-DD') OR substr(fitness_expiry, 1, 10) <= to_char((now() AT TIME ZONE 'UTC') + interval '+60 days', 'YYYY-MM-DD'))
        ${scope ? ' AND campus_id = ?' : ''}`,
      p
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
