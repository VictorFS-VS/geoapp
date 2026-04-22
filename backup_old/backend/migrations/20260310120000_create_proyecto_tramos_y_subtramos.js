// migrations/20260310120000_create_proyecto_tramos_y_subtramos.js

exports.up = async function(knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS ema');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS postgis');

  const hasTramos = await knex.schema.withSchema('ema').hasTable('proyecto_tramos');
  if (!hasTramos) {
    await knex.schema.withSchema('ema').createTable('proyecto_tramos', (table) => {
      table.increments('id_proyecto_tramo').primary();
      table.integer('id_proyecto').notNullable();
      table.text('descripcion').notNullable();
      table.integer('cantidad_universo').nullable();
      table.integer('id_vial_tramo').nullable();
      table.integer('orden').defaultTo(0);
      table.timestamp('creado_en').defaultTo(knex.fn.now());

      table.foreign('id_proyecto').references('gid').inTable('ema.proyectos');
    });
  }

  const hasSubtramos = await knex.schema.withSchema('ema').hasTable('proyecto_subtramos');
  if (!hasSubtramos) {
    await knex.schema.withSchema('ema').createTable('proyecto_subtramos', (table) => {
      table.increments('id_proyecto_subtramo').primary();
      table.integer('id_proyecto_tramo').notNullable();
      table.text('descripcion').notNullable();
      table.integer('cantidad_universo').nullable();
      table.integer('orden').defaultTo(0);
      table.timestamp('creado_en').defaultTo(knex.fn.now());

      table.foreign('id_proyecto_tramo')
        .references('id_proyecto_tramo')
        .inTable('ema.proyecto_tramos');
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.withSchema('ema').dropTableIfExists('proyecto_subtramos');
  await knex.schema.withSchema('ema').dropTableIfExists('proyecto_tramos');
};
