export async function verifyTerminalAccess(
  storeId?: string | null,
  deviceId?: string | null
) {
  // Development fallback: bypass terminal verification
  return {
    id: deviceId ?? "dev-terminal",
    deviceId: deviceId ?? "dev-device",
    storeId: storeId ?? "dev-store",
    label: "development terminal"
  };
}
