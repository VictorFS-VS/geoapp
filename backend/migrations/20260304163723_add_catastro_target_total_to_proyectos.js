// migrations/20260304163723_add_catastro_target_total_to_proyectos.js

exports.up = async function (knex) {
    // 1) Agregar columna
    await knex.raw('ALTER TABLE ema.proyectos ADD COLUMN catastro_target_total INTEGER NULL');

    // 2) Agregar constraint para permitir NULL y exigir > 0 cuando no sea NULL
    await knex.raw(`
    ALTER TABLE ema.proyectos
    ADD CONSTRAINT proyectos_catastro_target_total_positive
    CHECK (catastro_target_total IS NULL OR catastro_target_total > 0)
  `);
};

exports.down = async function (knex) {
    // 1) Quitar constraint si existe
    await knex.raw('ALTER TABLE ema.proyectos DROP CONSTRAINT IF EXISTS proyectos_catastro_target_total_positive');

    // 2) Quitar columna si existe
    await knex.raw('ALTER TABLE ema.proyectos DROP COLUMN IF EXISTS catastro_target_total');
};
