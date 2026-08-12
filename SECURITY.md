# Security policy

Please report security issues privately through GitHub's repository security-advisory interface. Do not include passwords, keyfiles, TOTP secrets, recovery material, or sensitive volume paths in an issue.

Material Encryption does not implement cryptography. VeraCrypt performs volume operations and remains subject to its own security model. Material Encryption deliberately omits volume passwords from IPC and command-line arguments and opens VeraCrypt's own credential prompt instead.
