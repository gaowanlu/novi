import type { Request } from 'express'

interface NoviUser {
    _id?: string,
    [key: string]: any,
}

interface IRequest extends Request {
    noviUser?: NoviUser | undefined
}

export type { NoviUser, IRequest };
