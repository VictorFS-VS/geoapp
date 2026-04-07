// migrations/20260407184500_fix_expedientes_clone_indexes.js

exports.up = async function (knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS ema.expedientes_unique_tipo
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_expedientes_proyecto_codigo_tipo
      ON ema.expedientes (id_proyecto, codigo_exp, tipo_expediente)
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS expedientes_uk_proyecto_codigo_unico
      ON ema.expedientes (id_proyecto, codigo_unico)
      WHERE codigo_unico IS NOT NULL AND codigo_unico <> ''
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS ema.idx_expedientes_proyecto_codigo_tipo
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS expedientes_unique_tipo
      ON ema.expedientes (id_proyecto, codigo_exp, tipo_expediente)
      WHERE tipo_expediente IS NOT NULL
  `);
};
