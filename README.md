# ddu-source-file_point

File point source for ddu.vim

This source collects current line of "filename" or "filename:line" format as
items.

## Required

### denops.vim

https://github.com/vim-denops/denops.vim

### ddu.vim

https://github.com/Shougo/ddu.vim

### ddu-kind-file

https://github.com/Shougo/ddu-kind-file

## Configuration

```vim
call ddu#start(#{ sources: [#{ name: 'file_point' }] })
```
