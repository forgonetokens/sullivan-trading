#!/usr/bin/env node
const bcrypt = require('bcrypt');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Enter admin password: ', async (password) => {
  if (!password || password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  console.log('\nAdd this to your .env file:\n');
  console.log(`ADMIN_PASSWORD_HASH="${hash}"`);
  rl.close();
});
