exports.up = async function(knex) {
  await knex.raw("ALTER TABLE ema.proyecto_subtramos ADD COLUMN id_vial_subtramo INTEGER NULL");
};

exports.down = async function(knex) {
  await knex.raw("ALTER TABLE ema.proyecto_subtramos DROP COLUMN IF EXISTS id_vial_subtramo");
};
