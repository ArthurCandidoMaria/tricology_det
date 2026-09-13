const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function buildQueryString(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.append(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

function toStorageUrl(bucket: string, objectName: string) {
  const normalized = objectName.replace(/^\/+/, '').split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `${API_BASE}/storage/${bucket}/${normalized}`;
}

class QueryBuilder {
  private table: string;
  private method: 'get' | 'post' | 'patch' = 'get';
  private payload: Record<string, unknown> | null = null;
  private filters: Record<string, string | number | boolean | null> = {};
  private orderBy: { field: string; ascending: boolean } | null = null;
  private isSingle = false;

  constructor(table: string) {
    this.table = table;
  }

  select(columns?: string) {
    void columns;
    return this;
  }

  eq(field: string, value: string | number | boolean | null) {
    this.filters[field] = value;
    return this;
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderBy = { field, ascending: options?.ascending ?? true };
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.method = 'post';
    this.payload = payload;
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.method = 'patch';
    this.payload = payload;
    return this;
  }

  maybeSingle() {
    this.isSingle = true;
    return this;
  }

  private async execute() {
    if (this.method === 'post' || this.method === 'patch') {
      const response = await fetch(`${API_BASE}/api/${this.table}`, {
        method: this.method === 'post' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(this.payload ?? {}), ...this.filters }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.detail || body?.message || 'Falha ao salvar o registro.');
      }

      const data = this.isSingle ? body : Array.isArray(body) ? body : [body];
      return { data: this.isSingle ? (Array.isArray(body) ? body[0] ?? null : body) : data, error: null };
    }

    const query = {
      ...this.filters,
      ...(this.orderBy ? { order_by: this.orderBy.field, order_direction: this.orderBy.ascending ? 'asc' : 'desc' } : {}),
    };

    const response = await fetch(`${API_BASE}/api/${this.table}${buildQueryString(query)}`);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.detail || body?.message || 'Falha ao consultar os dados.');
    }

    const data = Array.isArray(body) ? body : body ? [body] : [];
    return {
      data: this.isSingle ? (data[0] ?? null) : data,
      error: null,
    };
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null) {
    return this.execute().catch(onrejected);
  }
}

const storage = {
  from(bucket: string) {
    return {
      async upload(objectName: string, file: Blob | File, options?: Record<string, unknown>) {
        void options;
        const formData = new FormData();
        formData.append('bucket', bucket);
        formData.append('file', file, objectName);

        const response = await fetch(`${API_BASE}/api/storage/upload`, {
          method: 'POST',
          body: formData,
        });

        const body = await response.json().catch(() => null);
        if (!response.ok) {
          return { error: { message: body?.detail || 'Falha ao enviar o arquivo.' } };
        }

        return { data: body, error: null };
      },
      getPublicUrl(objectName: string) {
        return {
          data: {
            publicUrl: toStorageUrl(bucket, objectName),
          },
        };
      },
    };
  },
};

export const supabase = {
  from(table: string) {
    return new QueryBuilder(table);
  },
  storage,
};

