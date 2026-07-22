# Circle Agent Stack

Circle Agent Wallets and policies are optional signer/payment rails for agent
operations. The workflow contract remains the source of truth for settlement.
No private key, mnemonic, OTP, session credential, or API key is stored in the
repository. Any authentication or testnet funding step is an operator action.

The backend-only `CircleAgentWalletAdapter` wraps the official Circle CLI for
session status, Arc Testnet wallet discovery, balances, USDC transfers,
allowlisted contract execution, EIP-712 signing, and x402 service payment. It
adds workflow-scoped limits before invoking the CLI and never accepts OTPs from
an HTTP route. Circle Agent Wallet policy limits are currently mainnet-only, so
the Arc Testnet workflow limit is an application guard and not presented as a
Circle-enforced testnet policy.

Current status: code-complete but operator-blocked. No real Circle Wallet
session or payment is claimed. The next external action is an interactive
`circle wallet login <operator-email> --testnet`; the operator must enter the
OTP directly in that terminal. No OTP, cookie, session file, or credential
belongs in GitHub, Vercel, application logs, or chat.
