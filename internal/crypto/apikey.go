package crypto

import (
	"crypto/sha256"
	"encoding/hex"
)

// HashAPIKey stores only a SHA-256 digest of the random credential.
func HashAPIKey(raw string) string {
	value := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(value[:])
}
