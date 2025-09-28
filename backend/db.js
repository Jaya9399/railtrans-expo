const mariadb = require('mariadb');

const pool = mariadb.createPool({
  host: 'localhost',
  user: 'root',
  password: 'Jaya123',
  database: 'railtrans_expo',
  connectionLimit: 5
});

module.exports = pool;