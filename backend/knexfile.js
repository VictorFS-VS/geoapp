// knexfile.js
const path = require('path');
const fs = require('fs');

// Determina el entorno: development, staging o production
const env = process.env.NODE_ENV || 'development';

// Carga las variables de entorno desde .env.{env} o .env
const envPath = path.resolve(__dirname, `.env.${env}`);
const fallbackPath = path.resolve(__dirname, '.env');
const pathToLoad = fs.existsSync(envPath) ? envPath : fallbackPath;

console.log(`📌 Cargando variables de entorno desde: ${pathToLoad}`);

require('dotenv').config({
  path: pathToLoad
});

module.exports = {
  development: {
    client: 'pg',
    connection: {
      host:     process.env.DB_HOST,
      port:     process.env.DB_PORT || 5432,
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASS  // ahora sí estará definido
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './migrations'
    }
  },
  staging: {
    client: 'pg',
    connection: {
      host:     process.env.DB_HOST,
      port:     process.env.DB_PORT,
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASS
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './migrations'
    }
  },
  production: {
    client: 'pg',
    connection: {
      host:     process.env.DB_HOST,
      port:     process.env.DB_PORT,
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASS
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './migrations'
    }
  }
};
