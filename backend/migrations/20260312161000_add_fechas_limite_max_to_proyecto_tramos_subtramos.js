// migrations/20260312161000_add_fechas_limite_max_to_proyecto_tramos_subtramos.js

exports.up = async function (knex) {
  await knex.raw("ALTER TABLE ema.proyecto_tramos ADD COLUMN fecha_limite DATE NULL");
  await knex.raw("ALTER TABLE ema.proyecto_tramos ADD COLUMN fecha_max DATE NULL");

  await knex.raw("ALTER TABLE ema.proyecto_subtramos ADD COLUMN fecha_limite DATE NULL");
  await knex.raw("ALTER TABLE ema.proyecto_subtramos ADD COLUMN fecha_max DATE NULL");
};

exports.down = async function (knex) {
  await knex.raw("ALTER TABLE ema.proyecto_subtramos DROP COLUMN IF EXISTS fecha_max");
  await knex.raw("ALTER TABLE ema.proyecto_subtramos DROP COLUMN IF EXISTS fecha_limite");

  await knex.raw("ALTER TABLE ema.proyecto_tramos DROP COLUMN IF EXISTS fecha_max");
  await knex.raw("ALTER TABLE ema.proyecto_tramos DROP COLUMN IF EXISTS fecha_limite");
};

