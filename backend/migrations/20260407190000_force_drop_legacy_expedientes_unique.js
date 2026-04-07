// migrations/20260407190000_force_drop_legacy_expedientes_unique.js

exports.up = async function (knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'expedientes_unique'
          AND conrelid = 'ema.expedientes'::regclass
      ) THEN
        ALTER TABLE ema.expedientes
          DROP CONSTRAINT expedientes_unique;
      END IF;
    END$$;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS ema.expedientes_unique;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS ema.expedientes_unique_tipo;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_expedientes_proyecto_codigo_tipo
      ON ema.expedientes (id_proyecto, codigo_exp, tipo_expediente);
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS expedientes_uk_proyecto_codigo_unico
      ON ema.expedientes (id_proyecto, codigo_unico)
      WHERE codigo_unico IS NOT NULL AND codigo_unico <> '';
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS ema.idx_expedientes_proyecto_codigo_tipo;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'expedientes_unique'
          AND conrelid = 'ema.expedientes'::regclass
      ) THEN
        ALTER TABLE ema.expedientes
          ADD CONSTRAINT expedientes_unique UNIQUE (id_proyecto, codigo_exp);
      END IF;
    END$$;
  `);
};
