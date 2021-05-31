import {
  GetState,
  PartialState,
  SetState,
  State,
  StateCreator,
  StoreApi,
} from './vanilla'

export const redux = <S extends State, A extends { type: unknown }>(
  reducer: (state: S, action: A) => S,
  initial: S
) => (
  set: SetState<S>,
  get: GetState<S>,
  api: StoreApi<S> & {
    dispatch?: (a: A) => A
    devtools?: any
  }
): S & { dispatch: (a: A) => A } => {
  api.dispatch = (action: A) => {
    set((state: S) => reducer(state, action))
    if (api.devtools) {
      api.devtools.send(api.devtools.prefix + action.type, get())
    }
    return action
  }
  return { dispatch: api.dispatch, ...initial }
}

type NamedSet<T extends State> = {
  <K extends keyof T>(
    partial: PartialState<T, K>,
    replace?: boolean,
    name?: string
  ): void
}

export const devtools = <S extends State>(
  fn: (set: NamedSet<S>, get: GetState<S>, api: StoreApi<S>) => S,
  prefix?: string
) => (
  set: SetState<S>,
  get: GetState<S>,
  api: StoreApi<S> & { dispatch?: unknown; devtools?: any }
): S => {
  let extension
  try {
    extension =
      (window as any).__REDUX_DEVTOOLS_EXTENSION__ ||
      (window as any).top.__REDUX_DEVTOOLS_EXTENSION__
  } catch {}

  if (!extension) {
    if (
      process.env.NODE_ENV === 'development' &&
      typeof window !== 'undefined'
    ) {
      console.warn('Please install/enable Redux devtools extension')
    }
    api.devtools = null
    return fn(set, get, api)
  }
  const namedSet: NamedSet<S> = (state, replace, name) => {
    set(state, replace)
    if (!api.dispatch) {
      api.devtools.send(api.devtools.prefix + (name || 'action'), get())
    }
  }
  const initialState = fn(namedSet, get, api)
  if (!api.devtools) {
    const savedSetState = api.setState
    api.setState = <K extends keyof S>(
      state: PartialState<S, K>,
      replace?: boolean
    ) => {
      savedSetState(state, replace)
      api.devtools.send(api.devtools.prefix + 'setState', api.getState())
    }
    api.devtools = extension.connect({ name: prefix })
    api.devtools.prefix = prefix ? `${prefix} > ` : ''
    api.devtools.subscribe((message: any) => {
      if (message.type === 'DISPATCH' && message.state) {
        const ignoreState =
          message.payload.type === 'JUMP_TO_ACTION' ||
          message.payload.type === 'JUMP_TO_STATE'
        if (!api.dispatch && !ignoreState) {
          api.setState(JSON.parse(message.state))
        } else {
          savedSetState(JSON.parse(message.state))
        }
      } else if (
        message.type === 'DISPATCH' &&
        message.payload?.type === 'COMMIT'
      ) {
        api.devtools.init(api.getState())
      } else if (
        message.type === 'DISPATCH' &&
        message.payload?.type === 'IMPORT_STATE'
      ) {
        const actions = message.payload.nextLiftedState?.actionsById
        const computedStates =
          message.payload.nextLiftedState?.computedStates || []

        computedStates.forEach(
          ({ state }: { state: PartialState<S> }, index: number) => {
            const action = actions[index] || api.devtools.prefix + 'setState'

            if (index === 0) {
              api.devtools.init(state)
            } else {
              savedSetState(state)
              api.devtools.send(action, api.getState())
            }
          }
        )
      }
    })
    api.devtools.init(initialState)
  }
  return initialState
}

type Combine<T, U> = Omit<T, keyof U> & U
export const combine = <
  PrimaryState extends State,
  SecondaryState extends State
>(
  initialState: PrimaryState,
  create: (
    set: SetState<PrimaryState>,
    get: GetState<PrimaryState>,
    api: StoreApi<PrimaryState>
  ) => SecondaryState
): StateCreator<Combine<PrimaryState, SecondaryState>> => (set, get, api) =>
  Object.assign(
    {},
    initialState,
    create(
      (set as unknown) as SetState<PrimaryState>,
      (get as unknown) as GetState<PrimaryState>,
      (api as unknown) as StoreApi<PrimaryState>
    )
  )

type StateStorage = {
  getItem: (name: string) => string | null | Promise<string | null>
  setItem: (name: string, value: string) => void | Promise<void>
}
type StorageValue<S> = { state: S; version: number }
type PersistOptions<S> = {
  /** Name of the storage (must be unique) */
  name: string
  /**
   * A function returning a storage.
   * The storage must fit `window.localStorage`'s api (or an async version of it).
   * For example the storage could be `AsyncStorage` from React Native.
   *
   * @default () => localStorage
   */
  getStorage?: () => StateStorage
  /**
   * Use a custom serializer.
   * The returned string will be stored in the storage.
   *
   * @default JSON.stringify
   */
  serialize?: (state: StorageValue<S>) => string | Promise<string>
  /**
   * Use a custom deserializer.
   *
   * @param str The storage's current value.
   * @default JSON.parse
   */
  deserialize?: (str: string) => StorageValue<S> | Promise<StorageValue<S>>
  /**
   * Prevent some items from being stored.
   */
  blacklist?: (keyof S)[]
  /**
   * Only store the listed properties.
   */
  whitelist?: (keyof S)[]
  /**
   * A function returning another (optional) function.
   * The main function will be called before the state rehydration.
   * The returned function will be called after the state rehydration or when an error occurred.
   */
  onRehydrateStorage?: (state: S) => ((state?: S, error?: Error) => void) | void
  /**
   * If the stored state's version mismatch the one specified here, the storage will not be used.
   * This is useful when adding a breaking change to your store.
   */
  version?: number
  /**
   * A function to perform persisted state migration.
   * This function will be called when persisted state versions mismatch with the one specified here.
   */
  migrate?: (persistedState: any, version: number) => S | Promise<S>
}

interface Thenable<Value> {
  then<V>(onFulfilled: (value: Value) => V): Thenable<V>
  catch<V>(onRejected: (reason: Error) => V): Thenable<V>
}

const toThenable = <Result, Input>(
  fn: (input: Input) => Result | Promise<Result> | Thenable<Result>
) => (input: Input): Thenable<Result> => {
  try {
    const result = fn(input)
    if (result instanceof Promise) {
      return result as Thenable<Result>
    }
    return {
      then(onFulfilled) {
        return toThenable(onFulfilled)(result as Result)
      },
      catch(onRejected) {
        return this as Thenable<any> // FIXME can we avoid any ?
      },
    }
  } catch (e) {
    return {
      then(onFulfilled) {
        return this as Thenable<any> // FIXME can we avoid any ?
      },
      catch(onRejected) {
        return toThenable(onRejected)(e)
      },
    }
  }
}

export const persist = <S extends State>(
  config: StateCreator<S>,
  options: PersistOptions<S>
) => (set: SetState<S>, get: GetState<S>, api: StoreApi<S>): S => {
  const {
    name,
    getStorage = () => localStorage,
    serialize = JSON.stringify,
    deserialize = JSON.parse,
    blacklist,
    whitelist,
    onRehydrateStorage,
    version = 0,
    migrate,
  } = options || {}

  let storage: StateStorage | undefined

  try {
    storage = getStorage()
  } catch (e) {
    // prevent error if the storage is not defined (e.g. when server side rendering a page)
  }

  if (!storage) {
    return config(
      (...args) => {
        console.warn(
          `Persist middleware: unable to update ${name}, the given storage is currently unavailable.`
        )
        set(...args)
      },
      get,
      api
    )
  }

  const setItem = (): Promise<void> | void => {
    const state = { ...get() }

    if (whitelist) {
      ;(Object.keys(state) as (keyof S)[]).forEach((key) => {
        !whitelist.includes(key) && delete state[key]
      })
    }
    if (blacklist) {
      blacklist.forEach((key) => delete state[key])
    }

    if (storage) {
      toThenable(serialize)({ state, version }).then((serializedValue) => {
        storage?.setItem(name, serializedValue)
      })
    }
  }

  const savedSetState = api.setState

  api.setState = (state, replace) => {
    savedSetState(state, replace)
    void setItem()
  }

  // rehydrate initial state with existing stored state

  // a workaround to solve the issue of not storing rehydrated state in sync storage
  // the set(state) value would be later overridden with initial state by create()
  // to avoid this, we merge the state from localStorage into the initial state.
  // TODO: find a better solution for this
  let stateFromStorage
  ;(() => {
    const postRehydrationCallback = onRehydrateStorage?.(get()) || undefined
    // bind is used to avoid `TypeError: Illegal invocation` error
    toThenable(storage.getItem.bind(storage))(name)
      .then((storageValue) => {
        if (storageValue) {
          return deserialize(storageValue)
        }
      })
      .then((deserializedStorageValue) => {
        if (deserializedStorageValue) {
          if (deserializedStorageValue.version !== version) {
            if (migrate) {
              stateFromStorage = migrate(
                deserializedStorageValue.state,
                deserializedStorageValue.version
              )
              return stateFromStorage
            }
          } else {
            stateFromStorage = deserializedStorageValue.state
            set(deserializedStorageValue.state)
          }
        }
      })
      .then((migratedState) => {
        if (migratedState) {
          set(migratedState as PartialState<S, keyof S>)
          return setItem()
        }
      })
      .then(() => {
        postRehydrationCallback?.(get(), undefined)
      })
      .catch((e: Error) => {
        postRehydrationCallback?.(undefined, e)
      })
  })()

  const configResult = config(
    (...args) => {
      set(...args)
      void setItem()
    },
    get,
    api
  )

  return { ...configResult, ...(stateFromStorage || {}) }
}
