TWHO BIG IDEAS:
- remove cache as detail of stream, make that part of lookup
- instead of doing DFS/BFS, just loop over backlock freeing who we can until we cant free anyone else BUT ALSO, for each item in the backlog, check other backlog entries first

- ok do we need to put commits in jail as soon as they come in in case their parents are in flight? and then remember to remove them even if they pass the first check?

I'm interested in if there is a way that Bounded LRU could be always correct, I think 3 is the most sure fire and is an acceptable API, and I'm also wondering   
if an API where the strea's .write method is sync and returns nothing, and the stream emits groups of sorted commits could simplify things. \   