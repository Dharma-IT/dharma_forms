import assert from 'node:assert/strict'
import {productDetails,productText} from '../src/migration-products.ts'
const label=(_field:string,value:string)=>value
assert.equal(productText(productDetails({},label)),'WLI')
const details=productDetails({desired_treatment:'Tea;Protein',desired_treatment_1:'Tea',quantity_desired_treatment_1:'2',value_desired_treatment_1:'15.99'},label)
assert.equal(details.length,2)
assert.equal(details[0].quantity,'2')
assert.equal(details[0].value,'15.99')
assert.equal(details[1].value,'')
assert.equal(productText(details),'Tea; Protein')
const multiple=productDetails({desired_treatment_form:'Tea;Protein',value_desired_treatment_form:'100'},label)
assert.ok(multiple.every(d=>d.value===''))
assert.equal(productDetails({desired_treatment:'Tea',tipo_de_tratamiento:'Other'},label).length,1)
console.log('Product field mapping checks passed.')
