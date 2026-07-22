# Security

The MVP is not externally audited and must not be used with production funds.
Version 1 accepts only the configured Arc Testnet USDC address and uses
OpenZeppelin `SafeERC20`, bounded node arrays, explicit authorization, custom
errors, and reentrancy protection around value movement.

Report vulnerabilities privately to the repository owner before opening a
public issue. Include a minimal reproduction, affected contract/function, and
impact. Never include private keys, mnemonics, OTPs, cookies, or API keys.

Known limitations include testnet-only deployment, no arbitrary token support,
manual operator approval for sensitive actions, and the fact that compensation
cannot reverse arbitrary external effects.
