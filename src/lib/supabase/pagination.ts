/** A limited, offset-based Supabase query that can be fetched in stable pages. */
export type RangePageQuery<T> = {
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    data: T[] | null;
    error: unknown;
  }>;
};

/**
 * Reads all rows from a Supabase REST query using PostgREST's inclusive range.
 * Callers must add deterministic ordering before paging to prevent duplicates.
 */
export async function readAllPages<T>(
  query: RangePageQuery<T>,
  pageSize = 1000,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1)
    throw new RangeError("O tamanho da página deve ser um inteiro positivo.");

  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

/** Splits long `in` filters, then pages each chunk sequentially. */
export async function readAllInChunks<T>(
  ids: string[],
  createQuery: (chunk: string[]) => RangePageQuery<T>,
  chunkSize = 100,
  pageSize = 1000,
): Promise<T[]> {
  if (!Number.isInteger(chunkSize) || chunkSize < 1)
    throw new RangeError("O tamanho do lote deve ser um inteiro positivo.");

  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += chunkSize) {
    const chunk = ids.slice(offset, offset + chunkSize);
    rows.push(...(await readAllPages(createQuery(chunk), pageSize)));
  }
  return rows;
}
