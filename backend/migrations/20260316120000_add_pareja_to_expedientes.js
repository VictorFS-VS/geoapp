// migrations/20260316120000_add_pareja_to_expedientes.js

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.expedientes
      ADD COLUMN IF NOT EXISTS pareja_nombre TEXT NULL
  `);

  await knex.raw(`
    ALTER TABLE ema.expedientes
      ADD COLUMN IF NOT EXISTS pareja_ci TEXT NULL
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.expedientes
      DROP COLUMN IF EXISTS pareja_ci
  `);

  await knex.raw(`
    ALTER TABLE ema.expedientes
      DROP COLUMN IF EXISTS pareja_nombre
  `);
};
