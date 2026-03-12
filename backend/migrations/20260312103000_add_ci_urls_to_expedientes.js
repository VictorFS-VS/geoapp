// migrations/20260312103000_add_ci_urls_to_expedientes.js

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.expedientes
      ADD COLUMN IF NOT EXISTS ci_propietario_frente_url TEXT NULL
  `);

  await knex.raw(`
    ALTER TABLE ema.expedientes
      ADD COLUMN IF NOT EXISTS ci_propietario_dorso_url TEXT NULL
  `);

  await knex.raw(`
    ALTER TABLE ema.expedientes
      ADD COLUMN IF NOT EXISTS ci_adicional_frente_url TEXT NULL
  `);

  await knex.raw(`
    ALTER TABLE ema.expedientes
      ADD COLUMN IF NOT EXISTS ci_adicional_dorso_url TEXT NULL
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.expedientes
      DROP COLUMN IF EXISTS ci_adicional_dorso_url
  `);

  await knex.raw(`
    ALTER TABLE ema.expedientes
      DROP COLUMN IF EXISTS ci_adicional_frente_url
  `);

  await knex.raw(`
    ALTER TABLE ema.expedientes
      DROP COLUMN IF EXISTS ci_propietario_dorso_url
  `);

  await knex.raw(`
    ALTER TABLE ema.expedientes
      DROP COLUMN IF EXISTS ci_propietario_frente_url
  `);
};