// migrations/20260407170000_add_codigo_unico_to_expedientes.js

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.expedientes
      ADD COLUMN IF NOT EXISTS codigo_unico TEXT NULL
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS expedientes_uk_proyecto_codigo_unico
      ON ema.expedientes (id_proyecto, codigo_unico)
      WHERE codigo_unico IS NOT NULL AND codigo_unico <> ''
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS ema.expedientes_uk_proyecto_codigo_unico
  `);

  await knex.raw(`
    ALTER TABLE ema.expedientes
      DROP COLUMN IF EXISTS codigo_unico
  `);
};
