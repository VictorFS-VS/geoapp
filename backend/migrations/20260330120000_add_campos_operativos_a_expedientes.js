// migrations/20260330120000_add_campos_operativos_a_expedientes.js

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.expedientes
      ADD COLUMN IF NOT EXISTS superficie NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS superficie_afectada NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS progresiva_ini TEXT NULL,
      ADD COLUMN IF NOT EXISTS progresiva_fin TEXT NULL,
      ADD COLUMN IF NOT EXISTS margen TEXT NULL,
      ADD COLUMN IF NOT EXISTS porcentaje_afectacion NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS desafectado BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS desafectado_detalle JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS percepcion_notificador TEXT NULL,
      ADD COLUMN IF NOT EXISTS observacion_notificador TEXT NULL
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.expedientes
      DROP COLUMN IF EXISTS observacion_notificador,
      DROP COLUMN IF EXISTS percepcion_notificador,
      DROP COLUMN IF EXISTS desafectado_detalle,
      DROP COLUMN IF EXISTS desafectado,
      DROP COLUMN IF EXISTS porcentaje_afectacion,
      DROP COLUMN IF EXISTS margen,
      DROP COLUMN IF EXISTS progresiva_fin,
      DROP COLUMN IF EXISTS progresiva_ini,
      DROP COLUMN IF EXISTS superficie_afectada,
      DROP COLUMN IF EXISTS superficie
  `);
};
