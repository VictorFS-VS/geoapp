// migrations/20260413_create_cliente_cartera_miembro.js
/**
 * Crear tabla ema.cliente_cartera_miembro
 * Guarda la cartera propia de un cliente:
 * - cliente_id  => cliente titular de la cartera
 * - miembro_id  => cliente miembro asociado a esa cartera
 */

exports.up = async function (knex) {
  const hasTable = await knex.schema.withSchema("ema").hasTable("cliente_cartera_miembro");

  if (!hasTable) {
    console.log("  ✅ Creando tabla ema.cliente_cartera_miembro");

    await knex.schema.withSchema("ema").createTable("cliente_cartera_miembro", (table) => {
      table.integer("cliente_id").notNullable();
      table.integer("miembro_id").notNullable();
      table.timestamp("fecha_creacion").notNullable().defaultTo(knex.fn.now());

      table.primary(["cliente_id", "miembro_id"], {
        constraintName: "pk_cliente_cartera_miembro",
      });

      table
        .foreign("cliente_id", "fk_cliente_cartera_miembro_cliente")
        .references("id_cliente")
        .inTable("ema.cliente")
        .onDelete("CASCADE");

      table
        .foreign("miembro_id", "fk_cliente_cartera_miembro_miembro")
        .references("id_cliente")
        .inTable("ema.cliente")
        .onDelete("CASCADE");
    });

    // CHECK cliente_id <> miembro_id
    await knex.raw(`
      ALTER TABLE ema.cliente_cartera_miembro
      ADD CONSTRAINT chk_cliente_cartera_miembro_distinto
      CHECK (cliente_id <> miembro_id)
    `);

    // índices
    await knex.schema.withSchema("ema").table("cliente_cartera_miembro", (table) => {
      table.index(["cliente_id"], "idx_cliente_cartera_miembro_cliente");
      table.index(["miembro_id"], "idx_cliente_cartera_miembro_miembro");
    });
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.withSchema("ema").hasTable("cliente_cartera_miembro");

  if (hasTable) {
    console.log("  ↩️ Eliminando tabla ema.cliente_cartera_miembro");
    await knex.schema.withSchema("ema").dropTable("cliente_cartera_miembro");
  }
};