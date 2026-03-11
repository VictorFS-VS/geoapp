// migrations/20260310124500_add_ids_and_censo_to_expedientes.js

exports.up = async function (knex) {
    // Agregar columnas numéricas para persistir los IDs y la codificación censal
    await knex.raw('ALTER TABLE ema.expedientes ADD COLUMN id_tramo INTEGER NULL');
    await knex.raw('ALTER TABLE ema.expedientes ADD COLUMN id_sub_tramo INTEGER NULL');
    await knex.raw('ALTER TABLE ema.expedientes ADD COLUMN codigo_censo TEXT NULL');
};

exports.down = async function (knex) {
    // Quitar columnas en orden inverso
    await knex.raw('ALTER TABLE ema.expedientes DROP COLUMN IF EXISTS codigo_censo');
    await knex.raw('ALTER TABLE ema.expedientes DROP COLUMN IF EXISTS id_sub_tramo');
    await knex.raw('ALTER TABLE ema.expedientes DROP COLUMN IF EXISTS id_tramo');
};
