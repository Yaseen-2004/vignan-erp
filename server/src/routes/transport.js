import { Router } from 'express';
import { all, get, scalar } from '../db/connection.js';
import { asyncHandler, ok } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';
import { createResourceRouter } from '../lib/crud.js';
import { isAdmin, accessibleStudentIds } from '../lib/scope.js';

const router = Router();

router.use(
  '/vehicles',
  createResourceRouter({
    table: 'vehicles',
    module: 'transport',
    entityType: 'Vehicle',
    alias: 'v',
    select: `v.*, (SELECT COUNT(*) FROM routes r WHERE r.vehicle_id = v.id) AS route_count,
             (SELECT COUNT(*) FROM transport_allocations ta WHERE ta.vehicle_id = v.id AND ta.status = 'ACTIVE') AS student_count,
             (SELECT COALESCE(SUM(fr.total_cost), 0) FROM fuel_records fr WHERE fr.vehicle_id = v.id) AS fuel_cost,
             (SELECT COALESCE(SUM(vm.cost), 0) FROM vehicle_maintenance vm WHERE vm.vehicle_id = v.id) AS maintenance_cost`,
    searchable: ['v.vehicle_number', 'v.model'],
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
    alias: 'd',
    select: `d.*, v.vehicle_number`,
    joins: `LEFT JOIN vehicles v ON v.id = d.vehicle_id`,
    searchable: ['d.name', 'd.phone', 'd.license_number'],
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
    alias: 'r',
    select: `r.*, v.vehicle_number, v.capacity, d.name AS driver_name, d.phone AS driver_phone,
             (SELECT COUNT(*) FROM transport_allocations ta WHERE ta.route_id = r.id AND ta.status = 'ACTIVE') AS student_count`,
    joins: `LEFT JOIN vehicles v ON v.id = r.vehicle_id LEFT JOIN drivers d ON d.id = r.driver_id`,
    searchable: ['r.name', 'r.route_code', 'r.start_point', 'r.end_point'],
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
    alias: 'ta',
    select: `ta.*, s.first_name, s.last_name, s.admission_number, c.name AS class_name, sec.name AS section_name,
             r.name AS route_name, r.route_code, v.vehicle_number, d.name AS driver_name, d.phone AS driver_phone`,
    joins: `JOIN students s ON s.id = ta.student_id
            LEFT JOIN classes c ON c.id = s.class_id
            LEFT JOIN sections sec ON sec.id = s.section_id
            JOIN routes r ON r.id = ta.route_id
            LEFT JOIN vehicles v ON v.id = COALESCE(ta.vehicle_id, r.vehicle_id)
            LEFT JOIN drivers d ON d.id = r.driver_id`,
    searchable: ['s.first_name', 's.admission_number', 'r.name'],
    filterable: ['student_id', 'route_id', 'status', 'academic_year_id'],
    sortable: ['id'],
    required: ['student_id', 'route_id'],
    // Students and parents only see their own allocation.
    scopeClause: async (req) => {
      const allowed = await accessibleStudentIds(req.user);
      if (allowed === null) return null;
      if (!allowed.length) return { clause: '1 = 0', params: [] };
      return { clause: `ta.student_id IN (${allowed.map(() => '?').join(',')})`, params: allowed };
    },
  })
);

router.use(
  '/fuel',
  createResourceRouter({
    table: 'fuel_records',
    module: 'transport',
    entityType: 'Fuel Record',
    alias: 'fr',
    select: `fr.*, v.vehicle_number, u.full_name AS recorded_by_name`,
    joins: `JOIN vehicles v ON v.id = fr.vehicle_id LEFT JOIN users u ON u.id = fr.recorded_by`,
    searchable: ['v.vehicle_number', 'fr.bill_number'],
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
    alias: 'vm',
    select: `vm.*, v.vehicle_number, u.full_name AS recorded_by_name`,
    joins: `JOIN vehicles v ON v.id = vm.vehicle_id LEFT JOIN users u ON u.id = vm.recorded_by`,
    searchable: ['v.vehicle_number', 'vm.service_type', 'vm.garage'],
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
    alias: 'da',
    select: `da.*, d.name AS driver_name, d.phone`,
    joins: `JOIN drivers d ON d.id = da.driver_id`,
    searchable: ['d.name'],
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
