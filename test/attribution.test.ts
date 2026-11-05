import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { encodeFunctionData, erc20Abi } from 'viem'
import { fromDataSuffix, toDataSuffix } from '@celo/attribution-tags'
import { config, tokens } from '../src/config.js'
import { arsToWars } from '../src/money.js'

describe('attribution', () => {
  it('survives being appended to a real ERC-20 transfer', () => {
    const call = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: ['0x1111111111111111111111111111111111111111', arsToWars(3_750_00)],
    })
    const tagged = `${call}${toDataSuffix(config.attributionTag).slice(2)}`
    const decoded = fromDataSuffix(tagged as `0x${string}`)
    assert.deepEqual(decoded, { codes: [config.attributionTag], schemaId: 0 })
  })

  it('leaves the transfer arguments readable before the suffix', () => {
    const call = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: ['0x1111111111111111111111111111111111111111', arsToWars(100)],
    })
    assert.equal(call.slice(0, 10), '0xa9059cbb')
    assert.equal(call.length, 2 + 8 + 64 + 64)
  })

  it('uses the wARS token that Ripio issues', () => {
    assert.equal(tokens.wARS, '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d')
  })
})
