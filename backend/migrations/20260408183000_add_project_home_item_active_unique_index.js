"use strict";

exports.up = async function (knex) {
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_project_home_item_active_template
    ON ema.project_home_item (id_proyecto, item_type, id_plantilla)
    WHERE is_active = true AND id_plantilla IS NOT NULL;
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS ema.uq_project_home_item_active_template;
  `);
};
