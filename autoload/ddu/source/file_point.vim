function! ddu#source#file_point#cfile()
  const prev_line = '.'->getline()[: '.'->col()-1]
  const next_line = '.'->getline()['.'->col() :]
  const filename_pattern = '[0-9a-zA-Z_./#+*$%@,{}\[\]!~=:\\?-]*'
  const prev_cfile = prev_line->matchstr(filename_pattern ..'$')
  const next_cfile = next_line->matchstr('^' .. filename_pattern)
  return s:expand(prev_cfile .. next_cfile)->substitute('^file://', '', '')
endfunction

function! s:expand(path) abort
  return s:substitute_path_separator(
        \ (a:path =~# '^\~') ? a:path->fnamemodify(':p') : a:path)
endfunction

function! s:substitute_path_separator(path) abort
  return has('win32') ? a:path->substitute('\\', '/', 'g') : a:path
endfunction
