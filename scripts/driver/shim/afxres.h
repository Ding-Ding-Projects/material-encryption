/*
 * Stand-in for the MFC resource header.
 *
 * VeraCrypt's Driver.rc includes <afxres.h>, which ships with the MFC component
 * of Visual Studio. A Build Tools installation without MFC does not have it, and
 * the resource compiler fails on that alone — after every C and assembly source
 * has already compiled cleanly.
 *
 * afxres.h is only needed here for the standard Windows resource definitions and
 * the IDC_STATIC constant, both of which are supplied below. Nothing in the
 * driver's resource script uses MFC itself.
 */

#ifndef MATERIAL_ENCRYPTION_AFXRES_SHIM_H
#define MATERIAL_ENCRYPTION_AFXRES_SHIM_H

#include <windows.h>

#ifndef IDC_STATIC
#define IDC_STATIC (-1)
#endif

#endif
