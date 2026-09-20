/** Node 加载 src/*.ts：相对路径补 .ts，配合 --experimental-strip-types */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (
      err?.code === 'ERR_MODULE_NOT_FOUND' &&
      (specifier.startsWith('.') || specifier.startsWith('/')) &&
      !/\.(ts|js|mjs|cjs|json)$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context)
    }
    throw err
  }
}
