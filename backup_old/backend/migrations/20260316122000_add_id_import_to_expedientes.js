// migrations/20260316122000_add_id_import_to_expedientes.js

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.expedientes
      ADD COLUMN IF NOT EXISTS id_import TEXT NULL
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS expedientes_uk_proyecto_id_import
      ON ema.expedientes (id_proyecto, id_import)
      WHERE id_import IS NOT NULL AND id_import <> ''
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS ema.expedientes_uk_proyecto_id_import
  `);

  await knex.raw(`
    ALTER TABLE ema.expedientes
      DROP COLUMN IF EXISTS id_import
  `);
};
