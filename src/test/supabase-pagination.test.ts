import { describe, expect, it, vi } from "vitest";
import { readAllInChunks, readAllPages } from "@/lib/supabase/pagination";

function queryFor<T>(rows: T[], pageSize: number) {
  const range = vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, Math.min(to + 1, from + pageSize)),
    error: null,
  }));
  return { range, query: { range } };
}

describe("paginação das consultas Supabase", () => {
  it("combina páginas usando intervalos inclusivos", async () => {
    const { range, query } = queryFor([1, 2, 3, 4, 5], 2);

    await expect(readAllPages(query, 2)).resolves.toEqual([1, 2, 3, 4, 5]);
    expect(range.mock.calls).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("faz uma última consulta vazia quando o total fecha página", async () => {
    const { range, query } = queryFor(["a", "b", "c", "d"], 2);

    await expect(readAllPages(query, 2)).resolves.toEqual(["a", "b", "c", "d"]);
    expect(range).toHaveBeenCalledTimes(3);
  });

  it("divide filtros grandes em blocos antes de paginar", async () => {
    const queried: string[][] = [];
    const result = await readAllInChunks(
      ["a", "b", "c", "d", "e"],
      (ids) => {
        queried.push(ids);
        return queryFor(ids, 2).query;
      },
      2,
      2,
    );

    expect(queried).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(result).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("propaga erro de acesso em vez de devolver resultado parcial", async () => {
    const failure = new Error("Falha de consulta");
    const query = { range: async () => ({ data: null, error: failure }) };

    await expect(readAllPages(query)).rejects.toBe(failure);
  });

  it("rejeita tamanho de página inválido", async () => {
    const { query } = queryFor([1], 1);

    await expect(readAllPages(query, 0)).rejects.toThrow(RangeError);
  });
});
