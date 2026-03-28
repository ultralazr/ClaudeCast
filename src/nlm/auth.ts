import { execa } from 'execa'

/** Verify NLM auth is valid, re-login if expired. Call before any pipeline. */
export async function ensureAuth(): Promise<void> {
  try {
    await execa('nlm', ['notebook', 'list'])
    return // auth fine
  } catch (err) {
    const msg = String(err)
    if (!msg.includes('Authentication') && !msg.includes('auth') && !msg.includes('login')) {
      throw err // unrelated error
    }
  }

  console.log('  NLM auth expired — re-authenticating...')
  try {
    await execa('nlm', ['login'], { timeout: 120_000 })
    console.log('  Re-authenticated with NLM')
  } catch {
    throw new Error('Could not authenticate NLM. Run `nlm login` manually.')
  }
}
