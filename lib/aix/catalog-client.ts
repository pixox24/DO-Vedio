import catalog from "../../public/aix/catalog.json";
import type { AixCompact, AixMeta } from "./schema";

export const staticAixCatalog = catalog as { meta: AixMeta; items: AixCompact[] };
