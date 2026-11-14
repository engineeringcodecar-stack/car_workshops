import { toLatinDigits } from "@/lib/format";

/**
 * Main work-order services a branch does not offer. They are left out of that branch's
 * reception form, its floor page and its printed order. An order that already has one of
 * them filled in keeps showing it, so nothing recorded disappears.
 *
 * The branch is matched by the word in its name, like the car wash line, so the exact
 * spelling in the branches table is not relied on.
 */
export function hiddenMainServices(branchName?: string | null): string[] {
    return /المجر/.test(branchName || "") ? ["engineBelts", "brakePads", "sparkPlugs"] : [];
}

/** True when a service line carries anything worth showing (a status or a price). */
export function serviceInUse(entry?: { status?: string; price?: string | number | null } | null): boolean {
    return !!entry && (!!entry.status || String(entry.price ?? "").trim() !== "");
}

export type SavedCar = {
    make?: string | null;
    model?: string | null;
    plate_number?: string | null;
    engine_size?: string | null;
    booklet_serial?: string | null;
};

const carKey = (v?: string | null) => toLatinDigits(String(v ?? "")).trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The customer's saved car that the typed one refers to: the same plate when a plate is
 * typed and on file, otherwise the same make and model. Among several matches (the same car
 * saved twice) one with an engine size on file is preferred.
 */
export function matchSavedCar(cars: SavedCar[], plate: string, make: string, model: string): SavedCar | undefined {
    const byPlate = carKey(plate) ? cars.filter(c => carKey(c.plate_number) === carKey(plate)) : [];
    const pool = byPlate.length > 0
        ? byPlate
        : carKey(make) ? cars.filter(c => carKey(c.make) === carKey(make) && carKey(c.model) === carKey(model)) : [];
    return pool.find(c => carKey(c.engine_size)) || pool[0];
}

/** The car to fill the form with when a returning customer is picked: one with an engine size on file if there is one. */
export function defaultSavedCar<T extends SavedCar>(cars: T[]): T | undefined {
    return cars.find(c => carKey(c.engine_size)) || cars[0];
}
