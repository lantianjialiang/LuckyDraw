import {test} from 'node:test';
import assert from 'node:assert/strict';
import {userLabel} from '../../web/src/lib/userLabel.js';
test('员工显示姓名，旧资料缺少姓名时不暴露内部活动 ID',()=>{
 assert.equal(userLabel({username:'emp:lot_abc:001022',displayName:'王五'}),'王五');
 assert.equal(userLabel({username:'emp:lot_abc:001022'}),'员工 001022');
 assert.equal(userLabel({username:'emp:E2001'}),'员工 E2001');
 assert.equal(userLabel({username:'admin'}),'admin');
});

test('同名员工通过工号区分，保留前导零且不显示活动 ID',async()=>{
 const {employeeNumber}=await import('../../web/src/lib/userLabel.js');
 assert.equal(employeeNumber({employeeNo:'001022',displayName:'王五'}),'001022');
 assert.equal(employeeNumber({username:'emp:lot_abc:001023',displayName:'王五'}),'001023');
 assert.equal(employeeNumber({username:'admin'}),'—');
});
