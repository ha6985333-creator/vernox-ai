const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const res = await pool.query('SELECT id, business_name, services, business_description FROM tenants');
  console.log('Total tenants:', res.rows.length);
  res.rows.forEach(t => { 
    console.log('---'); 
    console.log('ID:', t.id); 
    console.log('Business:', t.business_name); 
    console.log('Services:', JSON.stringify(t.services)); 
    console.log('Description:', t.business_description); 
  }); 
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });