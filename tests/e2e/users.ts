/** Clerk dev-instance test users (`+clerk_test` addresses never receive real email). */
export const E2E_USERS = {
  owner: { email: "lendloop.owner+clerk_test@example.com", firstName: "Arjun", lastName: "Menon" },
  borrower: { email: "lendloop.borrower+clerk_test@example.com", firstName: "Divya", lastName: "Rao" },
} as const;

/** Sample neighbourhood used for granted geolocation (matches the seed data). */
export const E2E_LOCATION = { latitude: 12.9719, longitude: 77.6412 };
