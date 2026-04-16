/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.withSchema('ema')
    .createTable('informe_registro', (table) => {
      table.bigIncrements('id_registro').primary();
      table.bigInteger('id_informe').notNullable().references('id_informe').inTable('ema.informe').onDelete('CASCADE');
      table.timestamp('fecha_creado').defaultTo(knex.fn.now());
    })
    .createTable('formula', (table) => {
      table.increments('id_formula').primary();
      table.integer('id_plantilla').notNullable().references('id_plantilla').inTable('ema.informe_plantilla');
      table.string('nombre', 255).notNullable();
      table.integer('version').defaultTo(1);
      table.boolean('activo').defaultTo(true);
      table.timestamps(true, true);
      table.unique(['id_plantilla', 'version']);
    })
    .createTable('formula_regla', (table) => {
      table.increments('id_regla').primary();
      table.integer('id_formula').notNullable().references('id_formula').inTable('ema.formula').onDelete('CASCADE');
      table.integer('id_pregunta').notNullable().references('id_pregunta').inTable('ema.informe_pregunta');
      table.string('operador', 20).notNullable();
      table.text('valor_ref_1').notNullable();
      table.text('valor_ref_2');
      table.decimal('puntos', 10, 2).notNullable().defaultTo(0.00);
      table.text('etiqueta');
      table.integer('orden').defaultTo(0);
      table.boolean('activo').defaultTo(true);
      
      // Knex doesn't have a direct helper for check constraints in all dialects easily, 
      // but we can use raw. However, standard PG check is fine.
    })
    .createTable('formula_rango', (table) => {
      table.increments('id_rango').primary();
      table.integer('id_formula').notNullable().references('id_formula').inTable('ema.formula').onDelete('CASCADE');
      table.decimal('min_valor', 10, 2).notNullable();
      table.decimal('max_valor', 10, 2).notNullable();
      table.string('etiqueta_final', 100).notNullable();
      table.integer('prioridad').defaultTo(1);
      table.string('color_hex', 7).defaultTo('#666666');
    })
    .createTable('formula_resultado', (table) => {
      table.increments('id_resultado').primary();
      table.bigInteger('id_registro').notNullable().references('id_registro').inTable('ema.informe_registro').onDelete('CASCADE');
      table.integer('id_formula').notNullable().references('id_formula').inTable('ema.formula');
      table.decimal('score_total', 10, 2).notNullable().defaultTo(0.00);
      table.jsonb('etiquetas_json').notNullable().defaultTo('[]');
      table.jsonb('reglas_json').notNullable().defaultTo('[]');
      table.string('clasificacion', 100);
      table.integer('version_formula').notNullable();
      table.timestamp('fecha_calculo').defaultTo(knex.fn.now());
      table.unique(['id_registro', 'id_formula']);
    })
    .then(() => {
        // Adding the check constraint and indexes manually via raw for precision
        return knex.raw(`
            ALTER TABLE ema.formula_regla ADD CONSTRAINT ck_operador_valid CHECK (operador IN ('EQ','NEQ','GT','GTE','LT','LTE','IN','RANGE'));
            CREATE INDEX idx_regla_formula ON ema.formula_regla(id_formula);
            CREATE INDEX idx_regla_pregunta ON ema.formula_regla(id_pregunta);
            CREATE INDEX idx_rango_formula ON ema.formula_rango(id_formula);
            CREATE INDEX idx_resultado_registro ON ema.formula_resultado(id_registro);
            CREATE INDEX idx_resultado_formula ON ema.formula_resultado(id_formula);
        `);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.withSchema('ema')
    .dropTableIfExists('formula_resultado')
    .dropTableIfExists('formula_rango')
    .dropTableIfExists('formula_regla')
    .dropTableIfExists('formula')
    .dropTableIfExists('informe_registro')
};
