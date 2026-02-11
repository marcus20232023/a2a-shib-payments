const { EscrowSystem } = require('..\/escrow');
const { PaymentNegotiationSystem } = require('..\/payment-negotiation');

function runTests(){
  const escrow = new EscrowSystem('./test-escrow-state.json');
  const nego = new PaymentNegotiationSystem(escrow, './test-neg-state.json');

  // Quote in SHIB
  const q1 = nego.createQuote({ providerId: 'prov1', clientId: 'cli1', service: 'logo design', price: 1000000, token: 'SHIB' });
  const accepted1 = nego.accept(q1.id, 'cli1');
  const esc1 = escrow.get(accepted1.escrowId);
  console.log('SHIB escrow token:', esc1.token === 'SHIB');

  // Quote in USDC
  const q2 = nego.createQuote({ providerId: 'prov2', clientId: 'cli2', service: 'dev work', price: 50, token: 'USDC' });
  const accepted2 = nego.accept(q2.id, 'cli2');
  const esc2 = escrow.get(accepted2.escrowId);
  console.log('USDC escrow token:', esc2.token === 'USDC');

  // Cleanup test files
  try{ require('fs').unlinkSync('./test-escrow-state.json'); }catch(e){}
  try{ require('fs').unlinkSync('./test-neg-state.json'); }catch(e){}
}

runTests();
