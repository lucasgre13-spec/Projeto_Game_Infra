@echo off
setlocal
pushd "%~dp0" || exit /b 1
where node >nul 2>nul
if errorlevel 1 (
  echo Nexo Lab precisa do Node.js 22 ou superior no PATH.
  echo Instale o Node.js pelo site oficial https://nodejs.org e abra novamente.
  goto failure
)
call node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Atualize o Node.js para a versao 22 ou superior e abra novamente.
  goto failure
)
if not exist "server.mjs" (
  echo Pasta incompleta. Mantenha este arquivo junto de server.mjs, src e public.
  goto failure
)
echo Nexo Lab - simulacao local. Nenhuma conta AWS e necessaria.
echo Mantenha esta janela aberta. Para encerrar, pressione Ctrl+C.
echo Abra o endereco informado pelo servidor no navegador.
call node server.mjs %1
if errorlevel 1 (
  echo Nao foi possivel iniciar. Leia o erro acima.
  echo Se a porta estiver ocupada, use a janela ja aberta do laboratorio
  echo ou execute iniciar.cmd com outra porta, por exemplo: iniciar.cmd 4174
  echo Nenhum processo existente foi encerrado.
  goto failure
)
popd
exit /b 0
:failure
popd
pause
exit /b 1

