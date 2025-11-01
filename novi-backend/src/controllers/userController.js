export function getAllUsers(req, res) {
    res.json([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
    ])
}

export function getUserById(req, res) {
    const id = parseInt(req.params.id, 10)
    res.json({ id, name: `User ${id}` })
}
