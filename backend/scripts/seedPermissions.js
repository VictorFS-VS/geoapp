"use strict";
const pool = require("../db");

const MODULES = [
  "usuarios",
  "roles",
  "permisos",
  "proyectos",
  "project_home_config"
];

const ACTIONS = ["read", "create", "update", "delete"];
const EXTRA_PERMISSIONS = [
  ["informes.diagnostico.read", "Ver diagnóstico / scoring de informes"],
  ["informes.diagnostico.create", "Ejecutar diagnóstico / scoring de informes"],
  ["informes.diagnostico.update", "Actualizar diagnóstico / scoring de informes"],
  ["informes.diagnostico.delete", "Eliminar diagnóstico / scoring de informes"],
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const module of MODULES) {
      for (const action of ACTIONS) {
        const code = `${module}.${action}`;
        const description = `${action.toUpperCase()} en ${module}`;

        await client.query(`
          INSERT INTO public.permissions (code, description)
          VALUES ($1, $2)
          ON CONFLICT (code) DO NOTHING
        `, [code, description]);
      }
    }

    for (const [code, description] of EXTRA_PERMISSIONS) {
      await client.query(`
        INSERT INTO public.permissions (code, description)
        VALUES ($1, $2)
        ON CONFLICT (code) DO NOTHING
      `, [code, description]);
    }

    console.log("✅ Permisos base creados");

    // 🔥 Dar TODOS los permisos al ADMIN (role_id = 1)
    await client.query(`
      INSERT INTO public.role_permissions (role_id, permission_id)
      SELECT 1, id FROM public.permissions
      ON CONFLICT DO NOTHING
    `);

    console.log("✅ Permisos asignados al ADMIN");

    await client.query("COMMIT");
    process.exit(0);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

run();
