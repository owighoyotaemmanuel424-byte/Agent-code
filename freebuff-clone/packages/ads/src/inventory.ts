import { adInventorySchema } from "./select";
import type { AdInventory } from "./select";
import inventoryJson from "../config/inventory.json";

/** Validated at import time; inventory is configuration, never code. */
export const defaultAdInventory: AdInventory = adInventorySchema.parse(inventoryJson);
