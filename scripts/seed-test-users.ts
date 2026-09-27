/**
 * Seed script for test users
 * Run this with: npx tsx scripts/seed-test-users.ts
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEED_SUPER_ADMIN_PASSWORD
 * and SEED_COLLEGE_ADMIN_PASSWORD in .env
 */

import { createClient } from '@supabase/supabase-js';

const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL || 'sha@gmail.com';
const COLLEGE_ADMIN_EMAIL = process.env.SEED_COLLEGE_ADMIN_EMAIL || 'demo123@gmail.com';

async function seedTestUsers() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    process.exit(1);
  }

  const superAdminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
  const collegeAdminPassword = process.env.SEED_COLLEGE_ADMIN_PASSWORD;

  if (!superAdminPassword || !collegeAdminPassword) {
    console.error('Missing SEED_SUPER_ADMIN_PASSWORD or SEED_COLLEGE_ADMIN_PASSWORD environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  console.log('🌱 Starting test user seeding...');

  try {
    // Create test organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .upsert({
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Test Organization',
        plan: 'pro',
        status: 'active',
        ai_daily_quota: 100
      }, { onConflict: 'id' })
      .select()
      .single();

    if (orgError) {
      console.error('Error creating organization:', orgError);
      process.exit(1);
    }
    console.log('✅ Test organization created/updated:', org.name);

    // Create Super Admin user
    const { data: superAdminData, error: superAdminError } = await supabase.auth.admin.createUser({
      email: SUPER_ADMIN_EMAIL,
      password: superAdminPassword,
      email_confirm: true,
      user_metadata: {
        full_name: 'Super Admin'
      }
    });

    if (superAdminError) {
      console.error('Error creating super admin:', superAdminError);
      // Check if user already exists
      if (superAdminError.message.includes('already been registered')) {
        console.log('⚠️  Super admin already exists, skipping creation');
      } else {
        process.exit(1);
      }
    } else {
      console.log('✅ Super admin user created:', SUPER_ADMIN_EMAIL);

      // Create profile for Super Admin
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: superAdminData.user.id,
          organization_id: org.id,
          full_name: 'Super Admin',
          email: SUPER_ADMIN_EMAIL,
          must_change_password: false,
          is_active: true
        }, { onConflict: 'id' });

      if (profileError) {
        console.error('Error creating super admin profile:', profileError);
      } else {
        console.log('✅ Super admin profile created');
      }

      // Assign super_admin role
      const { error: roleError } = await supabase
        .from('user_roles')
        .upsert({
          user_id: superAdminData.user.id,
          role: 'super_admin',
          organization_id: org.id
        }, { onConflict: 'user_id,role' });

      if (roleError) {
        console.error('Error assigning super admin role:', roleError);
      } else {
        console.log('✅ Super admin role assigned');
      }
    }

    // Create College Admin user
    const { data: collegeAdminData, error: collegeAdminError } = await supabase.auth.admin.createUser({
      email: COLLEGE_ADMIN_EMAIL,
      password: collegeAdminPassword,
      email_confirm: true,
      user_metadata: {
        full_name: 'College Admin'
      }
    });

    if (collegeAdminError) {
      console.error('Error creating college admin:', collegeAdminError);
      // Check if user already exists
      if (collegeAdminError.message.includes('already been registered')) {
        console.log('⚠️  College admin already exists, skipping creation');
      } else {
        process.exit(1);
      }
    } else {
      console.log('✅ College admin user created:', COLLEGE_ADMIN_EMAIL);

      // Create profile for College Admin
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: collegeAdminData.user.id,
          organization_id: org.id,
          full_name: 'College Admin',
          email: COLLEGE_ADMIN_EMAIL,
          must_change_password: false,
          is_active: true
        }, { onConflict: 'id' });

      if (profileError) {
        console.error('Error creating college admin profile:', profileError);
      } else {
        console.log('✅ College admin profile created');
      }

      // Assign org_admin role
      const { error: roleError } = await supabase
        .from('user_roles')
        .upsert({
          user_id: collegeAdminData.user.id,
          role: 'org_admin',
          organization_id: org.id
        }, { onConflict: 'user_id,role' });

      if (roleError) {
        console.error('Error assigning org admin role:', roleError);
      } else {
        console.log('✅ College admin role assigned');
      }
    }

    console.log('\n🎉 Test user seeding completed successfully!');
    console.log('\n📋 Test Users:');
    console.log('   Super Admin:');
    console.log(`   - Email: ${SUPER_ADMIN_EMAIL}`);
    console.log('   - Password: (value of SEED_SUPER_ADMIN_PASSWORD)');
    console.log('   - URL: /super-admin/login');
    console.log('\n   College Admin:');
    console.log(`   - Email: ${COLLEGE_ADMIN_EMAIL}`);
    console.log('   - Password: (value of SEED_COLLEGE_ADMIN_PASSWORD)');
    console.log('   - URL: / (institution login)');

  } catch (error) {
    console.error('Unexpected error during seeding:', error);
    process.exit(1);
  }
}

seedTestUsers();