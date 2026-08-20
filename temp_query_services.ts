import { db } from '@workspace/db';
import { tenantsTable } from '@workspace/db';

async function main() {
  const tenants = await db.select({ 
    id: tenantsTable.id, 
    businessName: tenantsTable.businessName, 
    services: tenantsTable.services, 
    businessDescription: tenantsTable.businessDescription 
  }).from(tenantsTable);
  console.log('Total tenants:', tenants.length);
  tenants.forEach(t => { 
    console.log('---'); 
    console.log('ID:', t.id); 
    console.log('Business:', t.businessName); 
    console.log('Services:', JSON.stringify(t.services)); 
    console.log('Description:', t.businessDescription); 
  }); 
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });