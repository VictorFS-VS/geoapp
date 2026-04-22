// migrations/20250808141520_init_schema.js

exports.up = async function(knex) {
  // 1) Asegura el schema y la extensión PostGIS
  await knex.raw('CREATE SCHEMA IF NOT EXISTS ema');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS postgis');

  // 2) Crea tabla tramos solo si no existe
  const hasTramos = await knex.schema.withSchema('ema').hasTable('tramos');
  if (!hasTramos) {
    await knex.schema
      .withSchema('ema')
      .createTable('tramos', table => {
        table.increments('id_tramo').primary();
        table.string('nombre_tramo').notNullable().unique();
        table.integer('id_proyecto').notNullable();
      });
  }

  // 3) Crea tabla encuestas solo si no existe
  const hasEncuestas = await knex.schema.withSchema('ema').hasTable('encuestas');
  if (!hasEncuestas) {
    await knex.schema
      .withSchema('ema')
      .createTable('encuestas', table => {
        table.increments('id_encuesta').primary();
        table.integer('id_proyecto').notNullable();
        table.integer('id_tramo').notNullable()
             .references('id_tramo').inTable('ema.tramos')
             .onDelete('CASCADE');
        table.jsonb('payload').notNullable().defaultTo('{}');
        table.timestamp('created_at').defaultTo(knex.fn.now());
      });
  }
};

exports.down = async function(knex) {
  // Elimina tablas en orden inverso solo si existen
  const hasEncuestas = await knex.schema.withSchema('ema').hasTable('encuestas');
  if (hasEncuestas) {
    await knex.schema.withSchema('ema').dropTable('encuestas');
  }

  const hasTramos = await knex.schema.withSchema('ema').hasTable('tramos');
  if (hasTramos) {
    await knex.schema.withSchema('ema').dropTable('tramos');
  }

  // (Opcional) elimina el schema
  await knex.raw('DROP SCHEMA IF EXISTS ema CASCADE');
};
