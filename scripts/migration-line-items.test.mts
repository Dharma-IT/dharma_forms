import assert from 'node:assert/strict'
import {moneyCents,moneyText,lineItemData} from '../src/migration-line-items.ts'
assert.equal(moneyText(moneyCents('342.005')!), '342.01')
assert.equal(moneyText(moneyCents('0')!), '0.00')
const item={id:'1',name:'Tea',price:'39',quantity:'2',amount:'70.20',hs_line_item_currency_code:'USD'}
assert.equal(lineItemData(item).discount,'10')
assert.deepEqual(lineItemData(item).issues,[])
assert.ok(lineItemData({...item,price:null}).issues.length)
assert.ok(lineItemData({...item,amount:'100'}).issues.length)
console.log('Line-item money checks passed.')
