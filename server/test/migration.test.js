import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

 test('stageBrand migration supports repeat startup and the previous erroneous TEXT column', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luckydraw-migration-'));
  const run = (code) => {
    const result = spawnSync(process.execPath, ['--experimental-sqlite', '--input-type=module', '-e', code], {
      env: { ...process.env, DB_FILE: path.join(directory, 'test.db'), DATA_DIR: directory }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  };
  const moduleUrl = new URL('../src/db.js', import.meta.url).href;
  try {
    run(`const {db}=await import(${JSON.stringify(moduleUrl)}); db.exec("ALTER TABLE Lottery ADD COLUMN TEXT DEFAULT ''; ALTER TABLE Lottery DROP COLUMN stageBrand;"); db.prepare("INSERT INTO Lottery(id,title,createdAt,updatedAt) VALUES(?,?,?,?)").run('preserved','Existing event','now','now'); db.close();`);
    for (let i=0;i<2;i++) run(`const {db}=await import(${JSON.stringify(moduleUrl)}); const cols=db.prepare('PRAGMA table_info(Lottery)').all(); if(cols.filter(c=>c.name==='stageBrand').length!==1) throw Error('Missing stageBrand'); if(db.prepare('SELECT title FROM Lottery WHERE id=?').get('preserved').title!=='Existing event') throw Error('Data lost'); db.close();`);
  } finally { fs.rmSync(directory, {recursive:true,force:true}); }
 });
